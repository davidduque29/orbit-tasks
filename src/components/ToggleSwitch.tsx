import { useId } from 'react';
import type { ReactNode } from 'react';

export function ToggleSwitch({ checked, onChange, label, disabled = false, description }: {
  checked: boolean;
  onChange(next: boolean): void;
  label: string;
  disabled?: boolean;
  description?: ReactNode;
}) {
  const id = useId();
  return <div className="orbit-toggle-row">
    <div className="orbit-toggle-copy">
      <label htmlFor={id}>{label}</label>
      {description && <p>{description}</p>}
    </div>
    <input className="orbit-switch-input" id={id} type="checkbox" role="switch" aria-checked={checked}
      checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)}/>
  </div>;
}
