export const resolutions = ['1','5','15','60','240','1D','1W','1M'] as const;
export type Resolution = typeof resolutions[number];

export const RES_LABEL: Record<Resolution, string> = {
  '1':   '1m',
  '5':   '5m',
  '15':  '15m',
  '60':  '1h',
  '240': '4h',
  '1D':  '1D',
  '1W':  '1W',
  '1M':  '1M',
};

export const UI_RES_OPTIONS = resolutions.map(r => ({ value: r, label: RES_LABEL[r] }));

export const fmtResolution = (r: Resolution) => RES_LABEL[r];

export const devRouter = "95207db36f1528cfd0a020d965159bca6f21ee9b1478e44dbb511c517e15ee34";