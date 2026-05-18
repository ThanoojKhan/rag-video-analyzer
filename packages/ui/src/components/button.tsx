import type { ButtonHTMLAttributes, ReactNode } from 'react';

const variants = {
  primary:
    'rounded-full bg-sky-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-sky-600',
  secondary:
    'rounded-full bg-slate-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-600',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  children: ReactNode;
}

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonProps): JSX.Element {
  return <button type="button" className={`${variants[variant]} ${className}`.trim()} {...props} />;
}
