import { supabase } from './supabaseClient';
import { detectDeviceEnvironment } from '../domain/deviceCatalog';

export interface RegisteredDevice {
  id: string;
  owner_id: string;
  platform: string;
  enabled: boolean;
  device_name: string | null;
  manufacturer: string | null;
  device_model: string | null;
  browser_name: string | null;
  device_type: string | null;
  created_at: string;
  updated_at: string;
  last_seen_at: string | null;
  endpoint_hash: string;
}

export async function currentEndpointHash(): Promise<string | null> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return null;
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(subscription.endpoint));
  return Array.from(new Uint8Array(buffer), (part) => part.toString(16).padStart(2, '0')).join('');
}

export async function listRegisteredDevices(userId: string): Promise<RegisteredDevice[]> {
  // Never retrieve subscription_data, which contains secret browser encryption material.
  const { data, error } = await supabase.from('device_subscriptions')
    .select('id,owner_id,platform,enabled,device_name,manufacturer,device_model,browser_name,device_type,created_at,updated_at,last_seen_at,endpoint_hash')
    .eq('owner_id', userId)
    .order('updated_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as RegisteredDevice[];
}

export interface DeviceDetails {
  device_name: string;
  manufacturer: string;
  device_model: string;
}

export function validateDeviceDetails(details: DeviceDetails): void {
  if (details.device_name.trim().length < 2 || details.device_name.trim().length > 80) {
    throw new Error('El nombre debe contener entre 2 y 80 caracteres.');
  }
  if (details.manufacturer.trim().length < 2 || details.manufacturer.trim().length > 60) {
    throw new Error('Selecciona un fabricante válido.');
  }
  if (details.device_model.trim().length < 2 || details.device_model.trim().length > 100) {
    throw new Error('El modelo debe contener entre 2 y 100 caracteres.');
  }
}

export async function updateDeviceDetails(userId: string, deviceId: string, details: DeviceDetails): Promise<void> {
  validateDeviceDetails(details);
  const { error } = await supabase.from('device_subscriptions').update({
    device_name: details.device_name.trim(),
    manufacturer: details.manufacturer.trim(),
    device_model: details.device_model.trim(),
  }).eq('owner_id', userId).eq('id', deviceId);
  if (error) throw new Error(error.message);
}

export async function disableRegisteredDevice(userId: string, deviceId: string): Promise<void> {
  const { error } = await supabase.from('device_subscriptions')
    .update({ enabled: false, updated_at: new Date().toISOString() })
    .eq('owner_id', userId).eq('id', deviceId);
  if (error) throw new Error(error.message);
}

export async function recordDeviceEnvironment(userId: string, deviceId: string): Promise<void> {
  const info = detectDeviceEnvironment(navigator.userAgent);
  const { error } = await supabase.from('device_subscriptions').update({
    platform: info.platform,
    browser_name: info.browserName,
    device_type: info.deviceType,
    last_seen_at: new Date().toISOString(),
  }).eq('id', deviceId).eq('owner_id', userId);
  if (error) throw new Error(error.message);
}
