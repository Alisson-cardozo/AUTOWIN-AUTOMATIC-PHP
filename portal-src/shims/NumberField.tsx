import { useEffect, useRef, useState, InputHTMLAttributes } from "react"

interface NumberFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> {
  value: number
  onChange: (value: number) => void
}

export function NumberField({ value, onChange, ...rest }: NumberFieldProps) {
  const [raw, setRaw] = useState(value == null ? "" : String(value))
  const lastNumeric = useRef(value)

  useEffect(() => {
    if (value !== lastNumeric.current) {
      setRaw(value == null ? "" : String(value))
      lastNumeric.current = value
    }
  }, [value])

  return (
    <input
      type="number"
      inputMode="decimal"
      onFocus={(e) => e.target.select()}
      {...rest}
      value={raw}
      onChange={(e) => {
        const v = e.target.value
        setRaw(v)
        const n = v === "" || v === "-" ? 0 : Number(v)
        if (!Number.isNaN(n)) {
          lastNumeric.current = n
          onChange(n)
        }
      }}
    />
  )
}
