import { useState } from 'react';
import { Smartphone, ArrowRight } from 'lucide-react';
import { DeviceManager } from './DeviceManager';

export function DeviceAccountSection({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  return <div className="account-device-launch">
    <div className="account-device-icon"><Smartphone size={30} aria-hidden="true" /></div>
    <div>
      <strong>Equipos con notificaciones</strong>
      <p>Consulta los navegadores registrados, identifica tus dispositivos y desactiva suscripciones.</p>
    </div>
    <button type="button" onClick={() => setOpen(true)}><ArrowRight size={17} aria-hidden="true" /> Administrar</button>
    {open && <DeviceManager userId={userId} onClose={() => setOpen(false)} />}
  </div>;
}
