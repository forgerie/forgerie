import { forwardRef, type InputHTMLAttributes } from "react";
import "./TextField.css";

/** Atom: a code-face text input that can also be the editable part of a combobox. */
export const TextField = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "style">>(
  function TextField(props, ref) {
    return <input {...props} ref={ref} className="text-field" />;
  });
