const knownMediaPipeDiagnostics = ["INFO: Created TensorFlow Lite XNNPACK delegate for CPU.", "OpenGL error checking is disabled", "Feedback manager requires a model with a single signature inference. Disabling support for feedback tensors."];

export function isKnownMediaPipeDiagnostic(args: unknown[]) {
    const message = args.map(String).join(" ");
    return knownMediaPipeDiagnostics.some((diagnostic) => message === diagnostic || message.endsWith(diagnostic));
}

export function suppressKnownMediaPipeDiagnostics() {
    const warn = console.warn.bind(console);
    const error = console.error.bind(console);
    console.warn = (...args: unknown[]) => {
        if (!isKnownMediaPipeDiagnostic(args)) warn(...args);
    };
    console.error = (...args: unknown[]) => {
        if (!isKnownMediaPipeDiagnostic(args)) error(...args);
    };
    return () => {
        console.warn = warn;
        console.error = error;
    };
}
