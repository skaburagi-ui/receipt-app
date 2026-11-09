import { describe, expect, it } from 'vitest';
import { normalizeRegistrationNumber, validateRegistrationNumber, isValidCorporateNumberCheckDigit } from './registration';

describe('normalizeRegistrationNumber', () => {
  it('全角・ハイフン・空白を正規化する', () => {
    expect(normalizeRegistrationNumber('Ｔ－８７００１１０００５９０１').normalized).toBe('T8700110005901');
    expect(normalizeRegistrationNumber(' t-8700 1100 05901 ').normalized).toBe('T8700110005901');
    expect(normalizeRegistrationNumber('登録番号：T 8700110005901').normalized).toBe('T8700110005901');
  });
  it('Tなしの13桁にはTを補う', () => {
    expect(normalizeRegistrationNumber('8700110005901').normalized).toBe('T8700110005901');
  });
  it('空入力は null・issuesなし', () => {
    expect(normalizeRegistrationNumber('')).toEqual({ normalized: null, issues: [] });
    expect(normalizeRegistrationNumber('  - ')).toEqual({ normalized: null, issues: [] });
  });
});

describe('validateRegistrationNumber', () => {
  it('公式検証例（基礎番号700110005901→8700110005901）は一致', () => {
    expect(isValidCorporateNumberCheckDigit('8700110005901')).toBe(true);
    expect(validateRegistrationNumber('T8700110005901')).toEqual([]);
  });
  it('桁数・文字が不正なら error registration.format', () => {
    for (const bad of ['T123', 'T12345678901234', 'TABCDEFGHIJKLM', 'T870011000590']) {
      const issues = validateRegistrationNumber(bad);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({ code: 'registration.format', level: 'error' });
    }
  });
  it('法人番号形式でチェックデジット不一致なら info のみ（拒否・警告にしない。M11）', () => {
    const issues = validateRegistrationNumber('T9700110005901');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'registration.checkdigit', level: 'info' });
    expect(issues[0].message).toContain('個人事業者の番号は、この確認の対象ではありません');
  });
  it('先頭が0の番号はチェックデジットで警告しない（個人事業者の可能性）', () => {
    expect(validateRegistrationNumber('T0123456789012')).toEqual([]);
  });
  it('全角ハイフン入りでも検証できる', () => {
    expect(validateRegistrationNumber('Ｔ８７００－１１００－０５９０１')).toEqual([]);
  });
});
