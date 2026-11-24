// One labelled text field of the Profile Manager forms, with its error or note.
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/class-names'

export function Field(props: {
  /** Stable id part; the label is translated. */
  name: string
  label: string
  value: string
  onChange: (value: string) => void
  error?: string | null
  note?: React.ReactNode
  /** Monospace text, for ids and ports. */
  mono?: boolean
  inputClassName?: string
  disabled?: boolean
}): React.JSX.Element {
  const id = `profile-field-${props.name}`
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="font-semibold">
        {props.label}
      </Label>
      <Input
        id={id}
        value={props.value}
        disabled={props.disabled}
        aria-invalid={props.error ? true : undefined}
        aria-describedby={props.error || props.note ? `${id}-help` : undefined}
        className={cn(props.mono && 'font-mono md:text-[13px]', props.inputClassName)}
        onChange={(event) => props.onChange(event.target.value)}
      />
      {props.error ? (
        <p id={`${id}-help`} role="alert" className="text-xs text-destructive">
          {props.error}
        </p>
      ) : props.note ? (
        <p id={`${id}-help`} className="text-xs text-muted-foreground">
          {props.note}
        </p>
      ) : null}
    </div>
  )
}
