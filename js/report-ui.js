import { t } from './i18n.js';

export async function runReportExport(format, report, { button = null, showToast = null } = {}) {
  const label = button?.textContent || '';
  if (button) {
    button.disabled = true;
    button.textContent = t('exportPreparing');
  }
  try {
    if (format === 'docx') {
      const { downloadReportDocx } = await import('./report-docx.js');
      await downloadReportDocx(report);
    } else {
      const { downloadReportPdf } = await import('./report-pdf.js');
      await downloadReportPdf(report, {
        onProgress(page, total) {
          if (button) button.textContent = t('exportPage', { page, total });
        }
      });
    }
    showToast?.(t('exportReady'));
  } catch (error) {
    console.error('ChemCalc export failed', error);
    showToast?.(format === 'pdf' ? t('exportPdfFailed') : t('exportFailed'));
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = label;
    }
  }
}
