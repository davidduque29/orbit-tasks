import { describe, expect, it } from 'vitest';
import { detectDeviceEnvironment, DEVICE_CATALOG } from './deviceCatalog';

describe('device environment detection', () => {
  it('identifies iPhone Safari without guessing the exact model', () => {
    const info = detectDeviceEnvironment('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1');
    expect(info).toEqual({
      platform: 'ios',
      deviceType: 'phone',
      browserName: 'Safari',
      suggestedManufacturer: 'Apple',
    });
  });

  it('identifies a Samsung Android phone', () => {
    const info = detectDeviceEnvironment('Mozilla/5.0 (Linux; Android 14; SM-S721B) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36');
    expect(info.platform).toBe('android');
    expect(info.deviceType).toBe('phone');
    expect(info.suggestedManufacturer).toBe('Samsung');
  });

  it('identifies a desktop browser', () => {
    const info = detectDeviceEnvironment('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36');
    expect(info.platform).toBe('web');
    expect(info.deviceType).toBe('computer');
    expect(info.browserName).toBe('Chrome');
  });

  it('keeps an offline model selection fallback', () => {
    expect(DEVICE_CATALOG.Samsung).toContain('Galaxy S24 FE');
    expect(DEVICE_CATALOG.Otro).toContain('Otro modelo');
  });
});
