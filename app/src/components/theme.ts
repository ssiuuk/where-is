import { useColorScheme } from 'react-native';

const light = {
  bg: '#F3F5F4',
  card: '#FFFFFF',
  text: '#16201C',
  muted: '#5E6B66',
  border: '#DCE3E0',
  accent: '#1F6F5C',
  accentText: '#FFFFFF',
  accentSoft: '#E1F0EB',
  // place names are shown like label-maker tape
  tape: '#F6D64A',
  tapeText: '#1D1A0E',
  danger: '#B3261E',
  dangerSoft: '#FBE9E7',
  warnSoft: '#FFF4D6',
};

const dark: typeof light = {
  bg: '#0F1412',
  card: '#18201D',
  text: '#E7EEEA',
  muted: '#98A6A0',
  border: '#2A3531',
  accent: '#5CC4A6',
  accentText: '#08201A',
  accentSoft: '#1D3A31',
  tape: '#E6C53A',
  tapeText: '#1D1A0E',
  danger: '#F2B8B5',
  dangerSoft: '#3A1E1C',
  warnSoft: '#3A3216',
};

export type Colors = typeof light;

export function useColors(): Colors {
  return useColorScheme() === 'dark' ? dark : light;
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };
export const radius = { sm: 6, md: 12, lg: 16 };
export const font = { small: 13, body: 16, title: 20, big: 26 };
