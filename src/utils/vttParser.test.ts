import { describe, it, expect } from 'vitest';
import { parseVttTime, formatVttTime, shiftVttTimestamps } from './vttParser';

describe('vttParser', () => {
  describe('parseVttTime', () => {
    it('should parse HH:MM:SS.mmm format correctly', () => {
      expect(parseVttTime('01:23:45.678')).toBe(5025.678);
      expect(parseVttTime('00:00:00.000')).toBe(0);
    });

    it('should parse MM:SS.mmm format correctly', () => {
      expect(parseVttTime('23:45.678')).toBe(1425.678);
    });
  });

  describe('formatVttTime', () => {
    it('should format seconds into HH:MM:SS.mmm format correctly', () => {
      expect(formatVttTime(5025.678)).toBe('01:23:45.678');
      expect(formatVttTime(0)).toBe('00:00:00.000');
    });

    it('should pad single digits with zeros', () => {
      expect(formatVttTime(3661.001)).toBe('01:01:01.001');
    });

    it('should handle millisecond rollover properly', () => {
      // 0.9996 should round to 1.000 and bump seconds
      expect(formatVttTime(0.9996)).toBe('00:00:01.000');
    });
  });

  describe('shiftVttTimestamps', () => {
    const rawVtt = `WEBVTT

00:01:23.450 --> 00:01:25.600
Hello World!

01:59:59.900 --> 02:00:01.100
Rollover test.
`;

    it('should shift timestamps forward by 1 second', () => {
      const shifted = shiftVttTimestamps(rawVtt, 1);
      
      expect(shifted).toContain('00:01:24.450 --> 00:01:26.600');
      expect(shifted).toContain('02:00:00.900 --> 02:00:02.100');
    });

    it('should shift timestamps backwards by 0.5 seconds', () => {
      const shifted = shiftVttTimestamps(rawVtt, -0.5);
      
      expect(shifted).toContain('00:01:22.950 --> 00:01:25.100');
      expect(shifted).toContain('01:59:59.400 --> 02:00:00.600');
    });
  });
});
