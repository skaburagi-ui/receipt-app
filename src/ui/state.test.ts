import { describe, expect, it } from 'vitest';
import { createDefaultReceipt } from '../domain/defaults';
import { createDefaultDesign } from './defaults';
import { createInitialState, reducer } from './state';

describe('下書き復元時の確認チェック', () => {
  it('replace では登録番号と簡易対象事業の確認を両方外す', () => {
    const receipt = createDefaultReceipt('2026-11-06');
    receipt.confirmations = { ownRegistrationNumber: true, simpleInvoiceEligibleBusiness: true };
    const next = reducer(createInitialState('2026-11-06'), { type: 'replace', receipt, design: createDefaultDesign() });
    expect(next.receipt.confirmations).toEqual({ ownRegistrationNumber: false, simpleInvoiceEligibleBusiness: false });
  });

  it('発行者情報だけの復元でも確認を外す', () => {
    const state = createInitialState('2026-11-06');
    state.receipt.confirmations = { ownRegistrationNumber: true, simpleInvoiceEligibleBusiness: true };
    const next = reducer(state, { type: 'loadIssuer', issuer: state.receipt.issuer, design: {} });
    expect(next.receipt.confirmations).toEqual({ ownRegistrationNumber: false, simpleInvoiceEligibleBusiness: false });
  });
});
