import { fireEvent, render, screen } from '@testing-library/react';

import type { WatchStatus } from '@/lib/watchStatus';

import ItemActionsMenu from './ItemActionsMenu';

const item: WatchStatus = {
  key: 'tv:1',
  tmdb_id: 1,
  media_type: 'tv',
  title: '狂飙',
  status: 'watching',
  rating: 8,
  updated_at: 1,
};

function setup() {
  const anchor = document.createElement('button');
  document.body.appendChild(anchor);
  const onClose = jest.fn();
  const onAction = jest.fn(async () => undefined);
  render(
    <ItemActionsMenu
      item={item}
      anchor={anchor}
      onClose={onClose}
      onAction={onAction}
    />,
  );
  return { onClose, onAction };
}

describe('ItemActionsMenu', () => {
  it('focuses the menu itself so the rating preview keeps the saved value', () => {
    setup();
    expect(document.activeElement).toBe(screen.getByRole('menu'));
    expect(screen.getByRole('menu').textContent).toContain('8');
  });

  it('marks the current status and dispatches status changes', async () => {
    const { onAction } = setup();
    expect(
      screen.getByRole('menuitemradio', { name: /标为在看/ }),
    ).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('menuitemradio', { name: /标为弃番/ }));
    expect(onAction).toHaveBeenCalledWith(item, {
      type: 'status',
      status: 'dropped',
    });
  });

  it('requires a second click to remove and closes on Escape', () => {
    const { onAction, onClose } = setup();
    const remove = screen.getByRole('menuitem', { name: /移除记录/ });
    fireEvent.click(remove);
    expect(onAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('menuitem', { name: /确认移除/ }));
    expect(onAction).toHaveBeenCalledWith(item, { type: 'remove' });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
