// @vitest-environment jsdom
import React from 'react';
import {afterEach, expect, it} from 'vitest';
import {cleanup, fireEvent, render, screen} from '@testing-library/react';
import {SmartMoneyPnlSummary} from './SmartMoneyPnlSummary';

afterEach(cleanup);
it('switches both profit figures by window without substituting all-time data for missing windows', () => {
  render(<SmartMoneyPnlSummary data={[
    {window: 'all', total_profit: '123456789012345678.12', realized_profit: '-15'},
    {window: '1d', total_profit: '20', realized_profit: '0'},
  ]} />);
  expect(screen.getByText('$123,456,789,012,345,678.12')).toBeTruthy();
  expect(screen.getByText('-$15')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', {name: '24H'}));
  expect(screen.getByText('$20')).toBeTruthy();
  expect(screen.getByText('$0')).toBeTruthy();
  expect(screen.queryByText('-$15')).toBeNull();
  fireEvent.click(screen.getByRole('button', {name: '7D'}));
  expect(screen.getAllByText('—')).toHaveLength(2);
});
