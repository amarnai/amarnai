import { describe, it, expect } from 'vitest';
import { selectPlanAction } from './selectPlanAction';

describe('selectPlanAction', () => {
  it('routes Free -> paid as an upgrade (checkout)', () => {
    const action = selectPlanAction(
      { plan: 'FREE', cycle: null },
      { plan: 'pro', cycle: 'monthly' },
    );
    expect(action).toEqual({ kind: 'upgrade', plan: 'pro', cycle: 'monthly' });
  });

  it('routes Pro -> Business as an upgrade', () => {
    const action = selectPlanAction(
      { plan: 'PRO', cycle: 'MONTHLY' },
      { plan: 'business', cycle: 'annual' },
    );
    expect(action).toEqual({ kind: 'upgrade', plan: 'business', cycle: 'annual' });
  });

  it('routes Business -> Pro as an in-app change', () => {
    const action = selectPlanAction(
      { plan: 'BUSINESS', cycle: 'MONTHLY' },
      { plan: 'pro', cycle: 'monthly' },
    );
    expect(action).toEqual({ kind: 'change', plan: 'pro', cycle: 'monthly' });
  });

  it('routes a same-tier cycle switch as a change', () => {
    const action = selectPlanAction(
      { plan: 'PRO', cycle: 'MONTHLY' },
      { plan: 'pro', cycle: 'annual' },
    );
    expect(action).toEqual({ kind: 'change', plan: 'pro', cycle: 'annual' });
  });

  it('routes paid -> Free as a cancel', () => {
    const action = selectPlanAction(
      { plan: 'PRO', cycle: 'MONTHLY' },
      { plan: 'free', cycle: 'monthly' },
    );
    expect(action).toEqual({ kind: 'cancel' });
  });

  it('is a no-op when selecting the current plan and cycle', () => {
    expect(
      selectPlanAction({ plan: 'PRO', cycle: 'MONTHLY' }, { plan: 'pro', cycle: 'monthly' }),
    ).toEqual({ kind: 'noop' });
    expect(
      selectPlanAction({ plan: 'FREE', cycle: null }, { plan: 'free', cycle: 'monthly' }),
    ).toEqual({ kind: 'noop' });
  });
});
