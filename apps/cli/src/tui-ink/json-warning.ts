export function isJsonModuleExperimentalWarning(
  warning: string | Error,
  typeOrOptions?: string | NodeJS.EmitWarningOptions
): boolean {
  const warningName = warning instanceof Error
    ? warning.name
    : typeof typeOrOptions === "string"
      ? typeOrOptions
      : typeOrOptions?.type;
  const message = warning instanceof Error ? warning.message : warning;
  return (
    warningName === "ExperimentalWarning" &&
    message.includes("Importing JSON modules is an experimental feature")
  );
}
