// the small part of the "qrcode" package used to draw labels for printing
declare module 'qrcode' {
  type BitMatrix = { size: number; get(row: number, col: number): number | boolean };
  export function create(text: string, options?: { errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H' }): { modules: BitMatrix };
  const qrcode: { create: typeof create };
  export default qrcode;
}
