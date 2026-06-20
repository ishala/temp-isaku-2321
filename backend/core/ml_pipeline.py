"""
core/ml_pipeline.py
ML pipeline diport dari app.py (Streamlit) ke FastAPI.
Preprocessing: clean → slang → stopwords → negation → stemming → TF-IDF → predict
"""
import pickle
import json
import re
import numpy as np
from pathlib import Path
from dataclasses import dataclass
from typing import Optional
from scipy.special import softmax

import nltk
from Sastrawi.Stemmer.StemmerFactory import StemmerFactory
from nltk.stem import PorterStemmer

from core.logger import logger

# ── Path assets ───────────────────────────────────────────────────────────────
BASE_DIR   = Path(__file__).resolve().parent.parent
MODELS_DIR = BASE_DIR / "assets" / "models"
DATA_DIR   = BASE_DIR / "assets" / "data"

# Regex elongasi (huruf berulang) — sama seperti notebook data_new.ipynb
_RE_ELONG_2 = re.compile(r"(.)\1{2,}")   # 3+ → 2
_RE_ELONG_1 = re.compile(r"(.)\1+")      # 2+ → 1
_RE_URL     = re.compile(r"https?://\S+|www\.\S+")
_RE_SYMBOL  = re.compile(r"[^\w\s]")
_RE_NUMBER  = re.compile(r"\d")
_RE_EMOJI   = re.compile(
    "["
    "\U0001F300-\U0001FAFF"   # symbols, pictographs, emoticons, transport
    "\U00002600-\U000027BF"   # misc symbols & dingbats
    "\U0001F1E6-\U0001F1FF"   # regional indicators (flags)
    "\U00002190-\U000021FF"   # arrows
    "\U0000FE0F"              # variation selector
    "]+",
    flags=re.UNICODE,
)


# ── Download NLTK data ─────────────────────────────────────────────────────────
def _ensure_nltk():
    for corpus in ["stopwords"]:
        try:
            nltk.data.find(f"corpora/{corpus}")
        except LookupError:
            nltk.download(corpus, quiet=True)


# ── Data class hasil prediksi ─────────────────────────────────────────────────
@dataclass
class PredictionResult:
    nb_sentiment:   Optional[str]
    nb_confidence:  Optional[float]
    nb_probs:       Optional[dict]
    svm_sentiment:  Optional[str]
    svm_confidence: Optional[float]
    svm_probs:      Optional[dict]
    cleaned_text:   str
    model_agree:    Optional[bool]


# ── ML Pipeline class ─────────────────────────────────────────────────────────
class MLPipeline:
    """
    Singleton pipeline. Load model sekali saat startup,
    reuse untuk setiap request prediksi.
    """

    _instance: Optional["MLPipeline"] = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self._initialized = True
        self._load_all()

    # ── Load semua resource ────────────────────────────────────────────────────
    def _load_all(self):
        _ensure_nltk()

        # Models
        self.nb_model   = self._load_pickle("naive_bayes_model.pkl", "Naive Bayes")
        self.svm_model  = self._load_pickle("svm_model.pkl", "SVM")
        self.vectorizer = self._load_pickle("tfidf_vectorizer.pkl", "TF-IDF Vectorizer")

        # Kamus normalisasi (kamus_tidak_baku) — sumber sama seperti data_new.ipynb
        self.kamus = {}
        self._load_kamus()

        # Stopwords (Indonesia + English) — sama seperti notebook
        from nltk.corpus import stopwords
        stop_id = set(stopwords.words("indonesian"))
        stop_en = set(stopwords.words("english"))
        self.stopwords = stop_id | stop_en
        self.stopwords.update(["https", "co", "rt", "amp"])  # tambahan di notebook

        # Stemmer: Sastrawi (Indonesia) + Porter (Inggris)
        self.stemmer_id = StemmerFactory().create_stemmer()
        self.stemmer_en = PorterStemmer()

        logger.info("ML Pipeline initialized — NB: {}, SVM: {}, TF-IDF: {}, kamus: {} entri",
                    self.nb_model is not None,
                    self.svm_model is not None,
                    self.vectorizer is not None,
                    len(self.kamus))

    def _load_pickle(self, filename: str, label: str):
        path = MODELS_DIR / filename
        try:
            with open(path, "rb") as f:
                obj = pickle.load(f)
            logger.info(f"{label} loaded from {path}")
            return obj
        except FileNotFoundError:
            logger.warning(f"{label} not found at {path} — feature will be unavailable")
            return None
        except Exception as e:
            logger.error(f"Failed to load {label}: {e}")
            return None

    def _load_kamus(self):
        """
        Bangun kamus normalisasi (tidak_baku → baku) dari beberapa sumber,
        persis seperti pipeline di data_new.ipynb, lalu lowercase semua.
        """
        import pandas as pd

        # 1. Excel kamuskatabaku.xlsx (kolom: tidak_baku, kata_baku)
        try:
            xlsx = pd.read_excel(DATA_DIR / "kamuskatabaku.xlsx")
            self.kamus.update(dict(zip(xlsx["tidak_baku"], xlsx["kata_baku"])))
        except Exception as e:
            logger.warning(f"kamuskatabaku.xlsx tidak dimuat: {e}")

        # 2. combined_slang_words.txt — dipisah TAB (sesuai notebook)
        try:
            with open(DATA_DIR / "combined_slang_words.txt", "r", encoding="utf-8") as f:
                for line in f:
                    parts = line.strip().split("\t")
                    if len(parts) == 2:
                        self.kamus[parts[0]] = parts[1]
        except FileNotFoundError:
            logger.warning("combined_slang_words.txt tidak ditemukan")

        # 3. extended_slang_typo.json
        try:
            with open(DATA_DIR / "extended_slang_typo.json", "r", encoding="utf-8") as f:
                self.kamus.update(json.load(f))
        except FileNotFoundError:
            logger.warning("extended_slang_typo.json tidak ditemukan")

        # 4. colloquial-indonesian-lexicon.csv (kolom 0 = slang, kolom 1 = formal)
        try:
            col = pd.read_csv(DATA_DIR / "colloquial-indonesian-lexicon.csv")
            self.kamus.update(dict(zip(col.iloc[:, 0], col.iloc[:, 1])))
        except Exception as e:
            logger.warning(f"colloquial-indonesian-lexicon.csv tidak dimuat: {e}")

        # Lowercase seluruh key & value
        self.kamus = {str(k).lower(): str(v).lower() for k, v in self.kamus.items()}

    # ── Preprocessing steps (port 1:1 dari data_new.ipynb) ─────────────────────
    @staticmethod
    def clean_text(text: str) -> str:
        """A. Cleaning: emoji → lowercase → elongasi → URL → simbol → angka → spasi."""
        if text is None or (isinstance(text, float)) or str(text).strip() == "":
            return ""
        text = str(text)
        text = _RE_EMOJI.sub("", text)                  # hapus emoji
        text = text.lower()                              # case folding
        text = _RE_ELONG_2.sub(r"\1\1", text)           # elongasi 3+ → 2
        text = _RE_URL.sub("", text)                     # hapus URL
        text = _RE_SYMBOL.sub(" ", text)                # hapus simbol → spasi
        text = _RE_NUMBER.sub(" ", text)                # hapus angka → spasi
        text = " ".join(text.split())                   # rapikan whitespace
        return text

    def normalize_slang(self, text: str) -> str:
        """B. Normalisasi slang: cek kamus, lalu coba normalisasi elongasi 3+→2 / 2+→1."""
        if not isinstance(text, str):
            return ""
        hasil = []
        for word in text.split():
            if word in self.kamus:
                hasil.append(self.kamus[word]); continue
            norm2 = _RE_ELONG_2.sub(r"\1\1", word)       # 3+ → 2
            if norm2 in self.kamus:
                hasil.append(self.kamus[norm2]); continue
            norm1 = _RE_ELONG_1.sub(r"\1", word)         # 2+ → 1
            if norm1 in self.kamus:
                hasil.append(self.kamus[norm1]); continue
            hasil.append(norm2 if norm2 != word else word)
        return " ".join(hasil)

    def remove_stopwords(self, text: str) -> str:
        """D. Stopword removal (tokenisasi = split). Tanpa negation handling."""
        if not text:
            return ""
        return " ".join(w for w in text.split() if w not in self.stopwords)

    def stem_text(self, text: str) -> str:
        """E. Stemming: kata >4 huruf → Sastrawi, fallback Porter bila tak berubah."""
        if not text:
            return ""
        result = []
        for word in text.split():
            if len(word) <= 4:
                result.append(word)
            else:
                stemmed_id = self.stemmer_id.stem(word)
                if stemmed_id == word:
                    result.append(self.stemmer_en.stem(word))
                else:
                    result.append(stemmed_id)
        return " ".join(result)

    def preprocess(self, text: str) -> tuple[str, str]:
        """
        Full pipeline: cleaning → normalisasi → stopword → stemming.
        Returns: (cleaned_text, stemmed_text)
        """
        cleaned    = self.clean_text(text)
        normalized = self.normalize_slang(cleaned)
        no_stop    = self.remove_stopwords(normalized)
        stemmed    = self.stem_text(no_stop)
        return cleaned, stemmed

    # ── Prediction helpers ─────────────────────────────────────────────────────
    # Sistem hanya memakai 2 kelas: positif & negatif.
    _SENTIMENT_MAP = {
        "positif": "positive", "positive": "positive", "pos": "positive",
        "negatif": "negative", "negative": "negative", "neg": "negative",
    }
    _VALID_SENTIMENTS = ("positive", "negative")

    def _to_binary(self, classes, proba) -> tuple[str, float, dict]:
        """
        Petakan output model ke 2 kelas (positive/negative).
        Kelas lain (mis. neutral/netral) diabaikan dan probabilitasnya
        dinormalisasi ulang agar sistem konsisten hanya positif & negatif.
        """
        pairs = []
        for c, p in zip(classes, proba):
            mapped = self._SENTIMENT_MAP.get(str(c).lower())
            if mapped in self._VALID_SENTIMENTS:
                pairs.append((mapped, float(p)))

        if not pairs:  # tidak ada kelas valid — kembalikan netral-aman
            return "positive", 0.0, {"positive": None, "negative": None}

        total = sum(p for _, p in pairs) or 1.0
        probs = {"positive": 0.0, "negative": 0.0}
        for label, p in pairs:
            probs[label] += p / total

        sentiment  = max(probs, key=probs.get)
        confidence = probs[sentiment]
        return sentiment, confidence, probs

    def _predict_nb(self, stemmed: str) -> tuple[str, float, dict]:
        tfidf = self.vectorizer.transform([stemmed])
        proba = self.nb_model.predict_proba(tfidf)[0]
        return self._to_binary(self.nb_model.classes_, proba)

    def _predict_svm(self, stemmed: str) -> tuple[str, float, dict]:
        tfidf   = self.vectorizer.transform([stemmed])
        classes = self.svm_model.classes_

        if hasattr(self.svm_model, "predict_proba"):
            proba = self.svm_model.predict_proba(tfidf)[0]
        else:
            decision = self.svm_model.decision_function(tfidf)[0]
            if hasattr(decision, "__len__"):           # multi-kelas → softmax
                proba = softmax(decision)
            else:                                       # biner → sigmoid skalar
                p1 = 1.0 / (1.0 + np.exp(-float(decision)))
                proba = [1.0 - p1, p1]                  # selaras urutan classes_

        return self._to_binary(classes, proba)

    # ── Bobot kosakata per sentimen ────────────────────────────────────────────
    def top_features(self, n: int = 20) -> dict:
        """
        Daftar kosakata paling berpengaruh terhadap kelas sentimen, dihitung dari
        bobot fitur model probabilistik (feature_log_prob_).
        Bobot kata = log P(kata|positif) − log P(kata|negatif):
        nilai makin besar → makin kuat menarik ke positif; makin kecil → negatif.
        """
        empty = {"available": False, "positive": [], "negative": []}
        if not self.nb_model or not self.vectorizer:
            return empty
        if not hasattr(self.nb_model, "feature_log_prob_"):
            return empty

        try:
            features = self.vectorizer.get_feature_names_out()
        except Exception as e:
            logger.warning(f"get_feature_names_out gagal: {e}")
            return empty

        classes = list(self.nb_model.classes_)
        idx_pos = idx_neg = None
        for i, c in enumerate(classes):
            mapped = self._SENTIMENT_MAP.get(str(c).lower())
            if mapped == "positive":
                idx_pos = i
            elif mapped == "negative":
                idx_neg = i
        if idx_pos is None or idx_neg is None:
            return empty

        log_prob = self.nb_model.feature_log_prob_
        weights = log_prob[idx_pos] - log_prob[idx_neg]
        n = max(1, min(int(n), len(features)))

        order = np.argsort(weights)            # ascending: paling negatif → positif
        neg_idx = order[:n]
        pos_idx = order[::-1][:n]

        positive = [{"word": str(features[i]), "weight": round(float(weights[i]), 4)} for i in pos_idx]
        negative = [{"word": str(features[i]), "weight": round(float(weights[i]), 4)} for i in neg_idx]
        return {"available": True, "positive": positive, "negative": negative}

    # ── Public predict ─────────────────────────────────────────────────────────
    def predict(self, text: str) -> PredictionResult:
        """
        Jalankan NB + SVM sekaligus dalam satu call.
        Jika salah satu model tidak tersedia, field-nya akan None.
        """
        cleaned, stemmed = self.preprocess(text)

        nb_sentiment = nb_confidence = nb_probs = None
        svm_sentiment = svm_confidence = svm_probs = None

        if not stemmed:
            logger.debug("Empty text after preprocessing: '{}'", text[:50])
            return PredictionResult(
                nb_sentiment=None, nb_confidence=None, nb_probs=None,
                svm_sentiment=None, svm_confidence=None, svm_probs=None,
                cleaned_text=cleaned, model_agree=None,
            )

        if self.nb_model and self.vectorizer:
            try:
                nb_sentiment, nb_confidence, nb_probs = self._predict_nb(stemmed)
            except Exception as e:
                logger.error(f"NB prediction failed: {e}")

        if self.svm_model and self.vectorizer:
            try:
                svm_sentiment, svm_confidence, svm_probs = self._predict_svm(stemmed)
            except Exception as e:
                logger.error(f"SVM prediction failed: {e}")

        model_agree = None
        if nb_sentiment and svm_sentiment:
            model_agree = nb_sentiment == svm_sentiment

        logger.debug(
            "Predict '{}...' → NB={} ({:.0f}%), SVM={} ({:.0f}%), agree={}",
            text[:30],
            nb_sentiment, (nb_confidence or 0) * 100,
            svm_sentiment, (svm_confidence or 0) * 100,
            model_agree,
        )

        return PredictionResult(
            nb_sentiment=nb_sentiment,
            nb_confidence=nb_confidence,
            nb_probs=nb_probs,
            svm_sentiment=svm_sentiment,
            svm_confidence=svm_confidence,
            svm_probs=svm_probs,
            cleaned_text=cleaned,
            model_agree=model_agree,
        )

    def predict_stemmed(self, stemmed: str, cleaned: str = "") -> PredictionResult:
        """
        Prediksi NB + SVM langsung dari teks yang SUDAH dipreprocess (stemmed),
        tanpa mengulang preprocessing. Dipakai tahap Prediksi yang membaca
        hasil preprocessing dari DB.
        """
        nb_sentiment = nb_confidence = nb_probs = None
        svm_sentiment = svm_confidence = svm_probs = None

        if not stemmed or not stemmed.strip():
            return PredictionResult(
                nb_sentiment=None, nb_confidence=None, nb_probs=None,
                svm_sentiment=None, svm_confidence=None, svm_probs=None,
                cleaned_text=cleaned, model_agree=None,
            )

        if self.nb_model and self.vectorizer:
            try:
                nb_sentiment, nb_confidence, nb_probs = self._predict_nb(stemmed)
            except Exception as e:
                logger.error(f"NB prediction (stemmed) failed: {e}")

        if self.svm_model and self.vectorizer:
            try:
                svm_sentiment, svm_confidence, svm_probs = self._predict_svm(stemmed)
            except Exception as e:
                logger.error(f"SVM prediction (stemmed) failed: {e}")

        model_agree = None
        if nb_sentiment and svm_sentiment:
            model_agree = nb_sentiment == svm_sentiment

        return PredictionResult(
            nb_sentiment=nb_sentiment, nb_confidence=nb_confidence, nb_probs=nb_probs,
            svm_sentiment=svm_sentiment, svm_confidence=svm_confidence, svm_probs=svm_probs,
            cleaned_text=cleaned, model_agree=model_agree,
        )

    @property
    def nb_available(self) -> bool:
        return self.nb_model is not None and self.vectorizer is not None

    @property
    def svm_available(self) -> bool:
        return self.svm_model is not None and self.vectorizer is not None


# ── Singleton accessor ─────────────────────────────────────────────────────────
_pipeline: Optional[MLPipeline] = None

def get_pipeline() -> MLPipeline:
    """Dependency injection FastAPI — return singleton pipeline."""
    global _pipeline
    if _pipeline is None:
        _pipeline = MLPipeline()
    return _pipeline
