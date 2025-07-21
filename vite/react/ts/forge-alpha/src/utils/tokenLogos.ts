const logoModules = import.meta.glob('/src/assets/*-logo.png', {
  eager: true,
}) as Record<string, { default: string }>

const logoMap: Record<string, string> = {}

for (const path in logoModules) {
  const match = path.match(/\/([a-z0-9]+)-logo\.png$/i)
  if (match) {
    const key = match[1].toLowerCase()
    logoMap[key] = logoModules[path].default
  }
}

export default logoMap