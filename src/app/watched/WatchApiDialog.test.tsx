import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import WatchApiDialog from './WatchApiDialog';

const KEY = 'lunatv_YWxpY2U_abc123';

beforeEach(() => {
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({ apiKey: KEY, endpoint: '/api/v1/watched' }),
  })) as any;
});

describe('WatchApiDialog copy', () => {
  it('falls back to execCommand when the Clipboard API is unavailable (plain http)', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      configurable: true,
    });
    const exec = jest.fn(() => true);
    (document as any).execCommand = exec;

    render(<WatchApiDialog open onClose={() => undefined} />);
    fireEvent.click(await screen.findByRole('button', { name: '复制API Key' }));

    expect(exec).toHaveBeenCalledWith('copy');
    await waitFor(() =>
      expect(screen.getByLabelText('API Key')).toHaveValue(KEY),
    );
    // Temporary textarea is cleaned up
    expect(document.querySelectorAll('textarea')).toHaveLength(0);
  });
});
