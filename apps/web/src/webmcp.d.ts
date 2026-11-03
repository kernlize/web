// WebMCP declarative attributes, per webmachinelearning/webmcp declarative-api-explainer.md.
declare namespace astroHTML.JSX {
  interface FormHTMLAttributes {
    toolname?: string;
    tooldescription?: string;
    toolautosubmit?: boolean;
  }

  interface InputHTMLAttributes {
    toolparamdescription?: string;
  }
}
