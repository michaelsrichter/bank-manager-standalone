// Reference: safe rich text for slides and notes.
// Only **double stars** become bold. Everything else is plain text, so slide
// content and presenter details can never inject HTML.
import { Fragment } from 'react'

export function Rich({ text }: { text: string }) {
  const parts = text.split('**')
  return (
    <>
      {parts.map((part, index) => (index % 2 === 1
        ? <strong key={index}>{part}</strong>
        : <Fragment key={index}>{part}</Fragment>))}
    </>
  )
}
