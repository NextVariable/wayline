import {expect, it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {ToastBar} from '../components/Toast';

const noop = () => {};

it('offers a worded decline next to the action when asked', () => {
  const html = renderToStaticMarkup(<ToastBar toast={{id: 't', message: '迁入吗？', variant: 'info', action: {label: '迁入', onClick: noop, dismissLabel: '不用'}}} onDismiss={noop} />);
  expect(html).toContain('>迁入<');
  expect(html).toContain('>不用<');
  expect(html).not.toContain('aria-label="关闭提示"');
});

it('keeps the icon close button for ordinary notices', () => {
  const html = renderToStaticMarkup(<ToastBar toast={{id: 't', message: '已保存', variant: 'success'}} onDismiss={noop} />);
  expect(html).toContain('aria-label="关闭提示"');
});
