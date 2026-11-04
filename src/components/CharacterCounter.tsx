interface CharacterCounterProps {
  value: string;
  max: number;
}

export function CharacterCounter({ value, max }: CharacterCounterProps) {
  const used = value.length;
  const remaining = Math.max(0, max - used);
  const atLimit = remaining === 0;
  const nearLimit = !atLimit && remaining <= Math.ceil(max * 0.2);

  return (
    <div className={`field-count-feedback${atLimit ? ' field-count-limit' : nearLimit ? ' field-count-warning' : ''}`}
      aria-live={nearLimit || atLimit ? 'polite' : 'off'}>
      <span>{atLimit ? 'Límite alcanzado. No puedes escribir más.' :
        nearLimit ? `Te quedan ${remaining} caracteres.` : `Máximo ${max} caracteres.`}</span>
      <span className="field-counter" aria-label={`${used} de ${max} caracteres utilizados`}>
        {used}/{max}
      </span>
    </div>
  );
}
