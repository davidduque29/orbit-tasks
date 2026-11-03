import { supabase } from './supabaseClient';

export const PUBLIC_VAPID_KEY = 'BCgI8Nb5qNwidNIXz1ySLTsmQPWtwyPF0iYkPOT_fi3jEt9x4RBRI36MgHks7Hjn9rlmyGuLfCN7g84hLuLojwA';

export type PushState = 'unsupported' | 'install-required' | 'denied' | 'ready' | 'enabled';

function isInstalled(): boolean {
  return matchMedia('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function compatible(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext
    && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export async function getPushState(): Promise<PushState> {
  if (!compatible()) return 'unsupported';
  if (/iPad|iPhone|iPod/.test(navigator.userAgent) && !isInstalled()) return 'install-required';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission !== 'granted') return 'ready';
  const worker = await navigator.serviceWorker.ready;
  return (await worker.pushManager.getSubscription()) ? 'enabled' : 'ready';
}

function decodePublicKey(): Uint8Array<ArrayBuffer> {
  const text = PUBLIC_VAPID_KEY.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(text.padEnd(Math.ceil(text.length / 4) * 4, '='));
  const result = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) result[i] = raw.charCodeAt(i);
  return result;
}

async function hashEndpoint(endpoint: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export async function registerDevice(userId: string): Promise<void> {
  if (!compatible()) throw new Error('Web Push no está disponible en este navegador.');
  if (/iPad|iPhone|iPod/.test(navigator.userAgent) && !isInstalled()) {
    throw new Error('Abre Orbit Tasks desde el icono instalado en la pantalla de inicio.');
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('No se concedió permiso para recibir avisos.');
  const registration = await navigator.serviceWorker.ready;
  const subscription = (await registration.pushManager.getSubscription())
    ?? (await registration.pushManager.subscribe({
      userVisibleOnly: true, applicationServerKey: decodePublicKey(),
    }));
  const { error } = await supabase.from('device_subscriptions').upsert({
    owner_id: userId,
    platform: /iPhone|iPad|iPod/.test(navigator.userAgent) ? 'ios'
      : /Android/.test(navigator.userAgent) ? 'android' : 'web',
    endpoint_hash: await hashEndpoint(subscription.endpoint),
    subscription_data: subscription.toJSON(),
    enabled: true,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'owner_id,endpoint_hash' });
  if (error) throw new Error(error.message);
}

export async function unregisterDevice(userId: string): Promise<void> {
  if (!compatible()) return;
  const worker = await navigator.serviceWorker.ready;
  const subscription = await worker.pushManager.getSubscription();
  if (!subscription) return;
  const { error } = await supabase.from('device_subscriptions').update({ enabled: false })
    .eq('owner_id', userId).eq('endpoint_hash', await hashEndpoint(subscription.endpoint));
  if (error) throw new Error(error.message);
  await subscription.unsubscribe();
}
