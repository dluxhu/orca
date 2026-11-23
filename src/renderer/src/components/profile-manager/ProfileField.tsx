// One labelled text field of the Profile Manager forms, with its error or note.
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function Field(props: {
  /** Stable id part; the label is translated. */
  name: string
  label: string
  value: string
  onChange: (value: string) => void
  error?: string | null
  note?: string
}): React.JSX.Element {
  const id = `profile-field-${props.name}`
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{props.label}</Label>
      <Input
        id={id}
        value={props.value}
        aria-invalid={props.error ? true : undefined}
        onChange={(event) => props.onChange(event.target.value)}
      />
      {props.error ? (
        <p role="alert" className="text-xs text-destructive">
          {props.error}
        </p>
      ) : props.note ? (
        <p className="text-xs text-muted-foreground">{props.note}</p>
      ) : null}
    </div>
  )
}
