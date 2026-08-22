// Tests for the shared PDF export/share helper (docs/mobile-app-plan.md §19,
// §26 Phase 5). expo-print/expo-sharing/expo-file-system/legacy are mocked
// globally in jest.setup.ts; this file overrides their return values per test.
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { exportAndSharePdf, SharingUnavailableError } from '../exportPdf';

describe('exportAndSharePdf', () => {
  beforeEach(() => {
    (Print.printToFileAsync as jest.Mock).mockClear().mockResolvedValue({ uri: 'file:///tmp/print-output.pdf', base64: 'bW9jay1wZGY=' });
    (Sharing.isAvailableAsync as jest.Mock).mockClear().mockResolvedValue(true);
    (Sharing.shareAsync as jest.Mock).mockClear().mockResolvedValue(undefined);
    (FileSystem.writeAsStringAsync as jest.Mock).mockClear().mockResolvedValue(undefined);
  });

  it('asks Print for base64 output, writes it into the cache dir under a sanitized filename, then shares it', async () => {
    await exportAndSharePdf('<p>hi</p>', 'Fractions Quiz: Grade 6!');
    expect(Print.printToFileAsync).toHaveBeenCalledWith({ html: '<p>hi</p>', base64: true });
    expect(FileSystem.writeAsStringAsync).toHaveBeenCalledWith(
      expect.stringContaining('Fractions_Quiz_Grade_6'),
      'bW9jay1wZGY=',
      { encoding: 'base64' }
    );
    expect(Sharing.shareAsync).toHaveBeenCalledWith(
      expect.stringContaining('Fractions_Quiz_Grade_6'),
      { mimeType: 'application/pdf', dialogTitle: 'Fractions Quiz: Grade 6!' }
    );
  });

  it('falls back to a generic filename when the title has no usable characters', async () => {
    await exportAndSharePdf('<p>hi</p>', '   ');
    expect(Sharing.shareAsync).toHaveBeenCalledWith(expect.stringContaining('resource.pdf'), expect.anything());
  });

  it('throws if Print does not return base64 data', async () => {
    (Print.printToFileAsync as jest.Mock).mockResolvedValueOnce({ uri: 'file:///tmp/print-output.pdf' });
    await expect(exportAndSharePdf('<p>hi</p>', 'Title')).rejects.toThrow('Print did not return PDF data.');
  });

  it('throws SharingUnavailableError instead of sharing when the device cannot share', async () => {
    (Sharing.isAvailableAsync as jest.Mock).mockResolvedValueOnce(false);
    await expect(exportAndSharePdf('<p>hi</p>', 'Title')).rejects.toBeInstanceOf(SharingUnavailableError);
    expect(Sharing.shareAsync).not.toHaveBeenCalled();
  });
});
