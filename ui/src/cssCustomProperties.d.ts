import "react";

// Lets an inline style hand a measured value to a stylesheet as a custom
// property (`style={{ "--width": "120px" }}`) without a cast. The authoring
// gate allows only this form of inline style.
declare module "react" {
  interface CSSProperties {
    [property: `--${string}`]: string | number | undefined;
  }
}
