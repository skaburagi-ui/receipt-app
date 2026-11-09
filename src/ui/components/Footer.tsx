import { DISCLAIMER, NO_SERVER_NOTICE, TAX_GUIDE_URL } from '../copy';

export function Footer() {
  return (
    <footer className="site-footer">
      <p><strong>{NO_SERVER_NOTICE}</strong></p>
      <p>{DISCLAIMER}</p>
      <p>
        国税庁の案内：<a href={TAX_GUIDE_URL} target="_blank" rel="noopener noreferrer">インボイス制度について</a>
        　／　<a href="/licenses/fonts.txt" target="_blank" rel="noopener">フォントのライセンス（Noto Sans JP・Noto Serif JP）</a>
      </p>
    </footer>
  );
}
