import React from "react"

type Props = React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string
  children?: React.ReactNode
}

export default function Link({ href, children, ...rest }: Props) {
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  )
}
