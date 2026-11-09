# E2E補助：PDFを PyMuPDF（pip install pymupdf）で検査し、JSONを標準出力へ。
# 使い方: python -X utf8 -I pdf_inspect.py <file.pdf> [png出力ディレクトリ]
import json, sys
import pymupdf

f = sys.argv[1]
png_dir = sys.argv[2] if len(sys.argv) > 2 else None
d = pymupdf.open(f)
pages = []
for i, pg in enumerate(d):
    r = pg.rect
    pages.append({'wMm': round(r.width / 72 * 25.4, 2), 'hMm': round(r.height / 72 * 25.4, 2), 'text': pg.get_text()})
    if png_dir and i < 3:
        pg.get_pixmap(dpi=90).save(f'{png_dir}/{f.replace(chr(92), "/").split("/")[-1][:-4]}-p{i+1}.png')
fonts = sorted({x[3] for i in range(min(d.page_count, 3)) for x in d.get_page_fonts(i)})
print(json.dumps({'pages': d.page_count, 'sizes': pages, 'fonts': fonts,
                  'printScaling': d.xref_get_key(d.pdf_catalog(), 'ViewerPreferences')}, ensure_ascii=False))
