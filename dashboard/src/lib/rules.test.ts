import { describe, expect, it } from 'vitest';
import { broadcastReady, maskRegistrationId, tagReady } from './rules';

describe('campaign confirmation rules', () => {
  it('requires the SEND confirmation only for broadcast', () => {
    expect(broadcastReady('category', false, '')).toBe(true);
    expect(broadcastReady('broadcast', true, 'send')).toBe(false);
    expect(broadcastReady('broadcast', true, 'SEND')).toBe(true);
    expect(broadcastReady('broadcast', false, 'SEND')).toBe(false);
  });

  it('requires tag scope acknowledgement', () => {
    expect(tagReady('tag', false)).toBe(false);
    expect(tagReady('tag', true)).toBe(true);
    expect(tagReady('category', false)).toBe(true);
  });

  it('masks registration ids', () => {
    expect(maskRegistrationId('regAndroid1001')).toBe('regA…1001');
  });
});
