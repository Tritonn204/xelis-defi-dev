export const objectToHex = (obj: object) => {
  const json = JSON.stringify(obj);
  const encoder = new TextEncoder();
  const bytes = encoder.encode(json);
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}