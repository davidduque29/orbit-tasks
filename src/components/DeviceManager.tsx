import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { DEVICE_CATALOG, detectDeviceEnvironment } from '../domain/deviceCatalog';
import {
  currentEndpointHash, disableRegisteredDevice, listRegisteredDevices,
  recordDeviceEnvironment, updateDeviceDetails,
  type RegisteredDevice,
} from '../infrastructure/deviceRepository';
import { unregisterDevice } from '../infrastructure/pushSupport';

interface Props { userId: string; onClose(): void }

export function DeviceManager({ userId, onClose }: Props) {
  const [devices, setDevices] = useState<RegisteredDevice[]>([]);
  const [currentHash, setCurrentHash] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deviceName, setDeviceName] = useState('');
  const [manufacturer, setManufacturer] = useState('Otro');
  const [model, setModel] = useState('');
  const [feedback, setFeedback] = useState('');

  const refresh = useCallback(async () => {
    const [items, hash] = await Promise.all([
      listRegisteredDevices(userId), currentEndpointHash(),
    ]);
    setDevices(items);
    setCurrentHash(hash);
    const localDevice = items.find((device) => device.endpoint_hash === hash);
    if (localDevice) {
      await recordDeviceEnvironment(userId, localDevice.id);
    }
  }, [userId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void refresh().catch((error: unknown) => {
      if (active) setFeedback(error instanceof Error ? error.message : 'No se pudieron cargar los dispositivos.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refresh]);

  function edit(device: RegisteredDevice) {
    const env = detectDeviceEnvironment(navigator.userAgent);
    const brand = device.manufacturer || (device.endpoint_hash === currentHash ? env.suggestedManufacturer : 'Otro');
    setEditingId(device.id);
    setDeviceName(device.device_name || (device.endpoint_hash === currentHash ? 'Mi dispositivo' : 'Dispositivo registrado'));
    setManufacturer(brand in DEVICE_CATALOG ? brand : 'Otro');
    setModel(device.device_model || '');
    setFeedback('');
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingId) return;
    setBusyId(editingId);
    try {
      await updateDeviceDetails(userId, editingId, { device_name: deviceName, manufacturer, device_model: model });
      await refresh();
      setEditingId(null);
      setFeedback('Datos del dispositivo guardados.');
    } catch (cause) {
      setFeedback(cause instanceof Error ? cause.message : 'No se pudo guardar.');
    } finally { setBusyId(null); }
  }

  async function disable(device: RegisteredDevice) {
    if (!window.confirm(`¿Desactivar las notificaciones de "${device.device_name || 'este dispositivo'}"?`)) return;
    setBusyId(device.id);
    try {
      if (device.endpoint_hash === currentHash) {
        await unregisterDevice(userId);
        setCurrentHash(null);
      } else {
        // A remote browser cannot be unsubscribed from here; server delivery is blocked.
        await disableRegisteredDevice(userId, device.id);
      }
      await refresh();
      setFeedback('Notificaciones desactivadas. Puedes activarlas de nuevo en Avisos desde ese equipo.');
    } catch (cause) {
      setFeedback(cause instanceof Error ? cause.message : 'No se pudo desactivar el dispositivo.');
    } finally { setBusyId(null); }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="modal device-modal" role="dialog" aria-modal="true" aria-labelledby="devices-title">
        <div className="device-modal-heading">
          <div><h2 id="devices-title">Mis dispositivos</h2><p>Administra los equipos que reciben tus recordatorios.</p></div>
          <button type="button" className="outline" aria-label="Cerrar dispositivos" onClick={onClose}>✕</button>
        </div>
        <p className="device-help">Los modelos se seleccionan manualmente; el navegador no siempre informa el modelo exacto. No recopilamos IMEI ni número de serie.</p>
        {loading && <p>Consultando dispositivos…</p>}
        {!loading && devices.length === 0 && <p className="notice">Todavía no tienes dispositivos con Web Push registrados. Activa las notificaciones desde Avisos.</p>}
        <div className="device-list">
          {devices.map((device) => {
            const local = !!currentHash && currentHash === device.endpoint_hash;
            const activeEditor = editingId === device.id;
            return (
              <div className="device-item" key={device.id}>
                <div className="device-item-heading">
                  <span aria-hidden="true" className="device-emoji">{device.platform === 'web' ? '💻' : '📱'}</span>
                  <div className="device-details">
                    <strong>{device.device_name || (local ? 'Este dispositivo' : 'Dispositivo sin nombre')}</strong>
                    <small>{[device.manufacturer, device.device_model].filter(Boolean).join(' · ') || device.platform.toUpperCase()} · {device.browser_name || 'Navegador sin identificar'}</small>
                    <small>{local ? 'Equipo actual · ' : ''}{device.enabled ? 'Notificaciones activas' : 'Notificaciones desactivadas'}</small>
                  </div>
                  <span className={device.enabled ? 'device-status active' : 'device-status'}>{device.enabled ? 'Activo' : 'Inactivo'}</span>
                </div>
                <div className="device-actions">
                  <button type="button" className="outline" disabled={!!busyId} onClick={() => activeEditor ? setEditingId(null) : edit(device)}>{activeEditor ? 'Cancelar' : '✎ Editar equipo'}</button>
                  {device.enabled && <button type="button" className="danger" disabled={!!busyId} onClick={() => void disable(device)}>Desactivar avisos</button>}
                </div>
                {activeEditor && (
                  <form className="device-editor" onSubmit={(event) => void save(event)}>
                    <label>Nombre del dispositivo
                      <input value={deviceName} onChange={(event) => setDeviceName(event.target.value)} maxLength={80} required />
                    </label>
                    <label>Fabricante
                      <select value={manufacturer} onChange={(event) => { setManufacturer(event.target.value); setModel(''); }}>
                        {Object.keys(DEVICE_CATALOG).map((brand) => <option key={brand} value={brand}>{brand}</option>)}
                      </select>
                    </label>
                    <label>Modelo
                      <input list="device-models" value={model} onChange={(event) => setModel(event.target.value)} maxLength={100} placeholder="Escribe o selecciona un modelo" required />
                      <datalist id="device-models">{DEVICE_CATALOG[manufacturer]?.map((name) => <option value={name} key={name} />)}</datalist>
                    </label>
                    <button type="submit" disabled={!!busyId}>{busyId ? 'Guardando…' : 'Guardar dispositivo'}</button>
                  </form>
                )}
              </div>
            );
          })}
        </div>
        {feedback && <p className="device-feedback" role="status">{feedback}</p>}
        <p className="device-help">Para activar nuevamente avisos en un dispositivo remoto, abre Orbit Tasks en ese equipo y entra en Avisos.</p>
      </section>
    </div>
  );
}
