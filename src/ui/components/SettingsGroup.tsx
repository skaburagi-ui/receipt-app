import type { ReactNode } from 'react';

/** 詳細設定を短い一覧として見せ、必要な項目だけ開く。 */
export function SettingsGroup({ title, errorCount = 0, children }: { title: string; errorCount?: number; children: ReactNode }) {
  return (
    <details className="settings-group">
      <summary>
        <span>{title}</span>
        {errorCount > 0 ? <span className="settings-error-count">要確認 {errorCount}件</span> : null}
      </summary>
      <div className="settings-group-body">{children}</div>
    </details>
  );
}
