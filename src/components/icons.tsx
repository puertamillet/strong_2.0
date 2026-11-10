/** Line icons for the tab bar: 24px grid, drawn with currentColor so they follow the theme. */
const paths = {
  train: (
    <>
      <rect x="5" y="6.5" width="3" height="11" rx="1.2" />
      <rect x="16" y="6.5" width="3" height="11" rx="1.2" />
      <rect x="2.25" y="9.25" width="2.75" height="5.5" rx="1" />
      <rect x="19" y="9.25" width="2.75" height="5.5" rx="1" />
      <path d="M8 12h8" />
    </>
  ),
  history: (
    <>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.49-6.01" />
      <path d="M6 2.8V6h3.2" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  exercises: (
    <>
      <path d="M9.5 6.5H20M9.5 12H20M9.5 17.5H20" />
      <path d="M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01" strokeWidth="2.8" />
    </>
  ),
  settings: (
    <>
      <path d="M3.5 7h9.5M19 7h1.5M3.5 17h1.5M11 17h9.5" />
      <circle cx="16" cy="7" r="2.5" />
      <circle cx="8" cy="17" r="2.5" />
    </>
  ),
}

export type IconName = keyof typeof paths

export function Icon({ name }: { name: IconName }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      width="26"
      height="26"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  )
}
