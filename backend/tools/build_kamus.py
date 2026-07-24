import json
import pandas as pd
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "assets" / "data"
kamus = {}

try: 
    xlsx = pd.read_excel(DATA_DIR / "kamuskatabaku.xlsx")
    kamus.update(dict(zip(xlsx["tidak_baku"], xlsx["kata_baku"])))
except Exception as e:
    print('kamuskatabaku.xlsx dilewati:', e)

try:
    with open(DATA_DIR / 'combined_slang_words.txt', encoding='utf-8') as f:
        for line in f:
            p = line.strip().split('\t')
            if len(p) == 2:
                kamus[p[0]] = p[1]
except Exception as e:
    print('combined_slang_words.txt dilewati:', e)

try:
   with open(DATA_DIR / "extended_slang_typo.json", encoding="utf-8") as f:
        kamus.update(json.load(f))
except FileNotFoundError as e:
    print(e)

try:
    col = pd.read_csv(DATA_DIR / "colloquial-indonesian-lexicon.csv")
    kamus.update(dict(zip(col.iloc[:, 0], col.iloc[:, 1])))
except Exception as e:
    print("lexicon dilewati:", e)

kamus = {str(k).lower(): str(v).lower() for k, v in kamus.items()}

out = DATA_DIR / "kamus_compiled.json"
with open(out, "w", encoding="utf-8") as f:
    json.dump(kamus, f, ensure_ascii=False)

print(f"Selesai: {len(kamus)} entri disimpan ke {out}")