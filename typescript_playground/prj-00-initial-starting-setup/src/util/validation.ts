// Validation
export interface Validatable {
  fieldName: string;
  value: string | number;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
}

export function validate(
  validatableInput: Validatable,
  errorMessages: string[]
) {
  let isValid = true;
  if (validatableInput.required) {
    isValid = isValid && validatableInput.value.toString().trim().length !== 0;
    if (!isValid)
      errorMessages.push(`${validatableInput.fieldName} is required`);
  }
  if (
    validatableInput.minLength != null &&
    typeof validatableInput.value === "string"
  ) {
    isValid =
      isValid && validatableInput.value.length > validatableInput.minLength;
    if (!isValid)
      errorMessages.push(
        `${validatableInput.fieldName} needs to be longer than ${validatableInput.minLength}`
      );
  }
  if (
    validatableInput.maxLength != null &&
    typeof validatableInput.value === "string"
  ) {
    isValid =
      isValid && validatableInput.value.length < validatableInput.maxLength;
    if (!isValid)
      errorMessages.push(
        `${validatableInput.fieldName} needs to be shorter than ${validatableInput.maxLength}`
      );
  }
  if (
    validatableInput.min != null &&
    typeof validatableInput.value === "number"
  ) {
    isValid = isValid && validatableInput.value > validatableInput.min;
    if (!isValid)
      errorMessages.push(
        `The number of ${validatableInput.fieldName} needs to be more than ${validatableInput.min}`
      );
  }
  if (
    validatableInput.max != null &&
    typeof validatableInput.value === "number"
  ) {
    isValid = isValid && validatableInput.value > validatableInput.max;
    if (!isValid)
      errorMessages.push(
        `The number of ${validatableInput.fieldName} needs to be less than ${validatableInput.min}`
      );
  }
  return isValid;
}
