import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select";

/** Compact application adapter around the shared Gr8r Select. */
export function ChoiceSelect({
  id,
  value,
  defaultValue,
  disabled,
  className,
  onValueChange,
  options,
}: {
  id?: string;
  value?: string | number;
  defaultValue?: string;
  disabled?: boolean;
  className?: string;
  onValueChange: (value: string) => void;
  options: { value: string | number; label: string; disabled?: boolean }[];
}) {
  return (
    <Select
      value={value === undefined ? undefined : String(value)}
      defaultValue={defaultValue}
      disabled={disabled}
      onValueChange={onValueChange}
    >
      <SelectTrigger id={id} className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem
            key={option.value}
            value={String(option.value)}
            disabled={option.disabled}
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
