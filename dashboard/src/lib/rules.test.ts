import { describe, expect, it } from 'vitest';
import { broadcastReady, maskRegistrationId, tagReady, targetedPreview } from './rules';

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

  it('never treats a library preview as a broadcast', () => {
    expect(targetedPreview(2, false)).toBe('ready');
    expect(targetedPreview(0, false)).toBe('no-targets');
    expect(targetedPreview(2, true)).toBe('blocked');
  });

  it('masks registration ids', () => {
    expect(maskRegistrationId('regAndroid1001')).toBe('regA…1001');
  });
});
