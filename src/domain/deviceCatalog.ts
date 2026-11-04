export const DEVICE_CATALOG: Record<string, string[]> = {
  Apple: ['iPhone 18 Pro Max', 'iPhone 18 Pro', 'iPhone 18', 'iPhone 17 Pro Max', 'iPhone 17 Pro', 'iPhone 17', 'iPhone 16 Pro Max', 'iPhone 16 Pro', 'iPhone 16', 'iPhone 15', 'iPad Pro', 'iPad Air', 'Otro Apple'],
  Samsung: ['Galaxy S24 FE', 'Galaxy S24', 'Galaxy S24 Ultra', 'Galaxy S25', 'Galaxy S25 Ultra', 'Galaxy S26', 'Galaxy A55', 'Galaxy A56', 'Galaxy Tab', 'Otro Samsung'],
  Xiaomi: ['Xiaomi 15', 'Xiaomi 14', 'Redmi Note 14', 'Redmi Note 13', 'POCO', 'Otro Xiaomi'],
  Motorola: ['Moto G', 'Motorola Edge', 'Razr', 'Otro Motorola'],
  Google: ['Pixel 9', 'Pixel 10', 'Pixel 11', 'Pixel Tablet', 'Otro Google'],
  Honor: ['Honor Magic', 'Honor X', 'Otro Honor'],
  Huawei: ['Pura', 'Mate', 'Nova', 'Otro Huawei'],
  Otro: ['Otro modelo'],
};

export interface DeviceEnvironment {
  platform: 'ios' | 'android' | 'web';
  deviceType: 'phone' | 'tablet' | 'computer' | 'unknown';
  browserName: string;
  suggestedManufacturer: string;
}

export function detectDeviceEnvironment(userAgent: string): DeviceEnvironment {
  const ios = /iPhone|iPad|iPod/i.test(userAgent);
  const android = /Android/i.test(userAgent);
  const tablet = /iPad|Tablet|Android(?!.*Mobile)/i.test(userAgent);
  const phone = /iPhone|iPod|Android.*Mobile/i.test(userAgent);
  const browserName = /Edg\//i.test(userAgent) ? 'Edge'
    : /CriOS|Chrome\//i.test(userAgent) ? 'Chrome'
    : /FxiOS|Firefox\//i.test(userAgent) ? 'Firefox'
    : /Safari\//i.test(userAgent) ? 'Safari' : 'Otro navegador';
  return {
    platform: ios ? 'ios' : android ? 'android' : 'web',
    deviceType: tablet ? 'tablet' : phone ? 'phone' : /Windows|Macintosh|Linux/i.test(userAgent) ? 'computer' : 'unknown',
    browserName,
    suggestedManufacturer: ios ? 'Apple' : /Samsung|SM-[A-Z0-9]/i.test(userAgent) ? 'Samsung' : 'Otro',
  };
}
