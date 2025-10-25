import { describe, it, expect, beforeEach, vi } from '@jest/globals';
import { renderHook, act } from '@testing-library/react';
import { useCartStore } from '../cart';

// Mock crypto.randomUUID
Object.defineProperty(global, 'crypto', {
  value: {
    randomUUID: jest.fn(() => 'mock-uuid-123')
  }
});

describe('Cart Store', () => {
  beforeEach(() => {
    // Clear cart before each test using the hook
    const { result } = renderHook(() => useCartStore());
    act(() => {
      result.current.clear();
    });
  });

  it('should initialize with empty cart', () => {
    const { result } = renderHook(() => useCartStore());
    expect(result.current.items).toEqual([]);

    // Calculate totals manually since they're not direct store properties
    const total = result.current.items.reduce((acc, item) => acc + item.unitPrice * item.quantity, 0);
    const itemCount = result.current.items.reduce((acc, item) => acc + item.quantity, 0);

    expect(total).toBe(0);
    expect(itemCount).toBe(0);
  });

  it('should add item to cart', () => {
    const { result } = renderHook(() => useCartStore());
    const testProduct = {
      productId: '1',
      slug: 'test-product',
      title: 'Test Product',
      currency: 'EUR',
      basePrice: 100,
      unitPrice: 100,
      selectedOptions: [],
      addOns: [],
      customFields: []
    };

    act(() => {
      result.current.addItem(testProduct);
    });

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]).toEqual(expect.objectContaining(testProduct));

    // Calculate totals manually
    const total = result.current.items.reduce((acc, item) => acc + item.unitPrice * item.quantity, 0);
    const itemCount = result.current.items.reduce((acc, item) => acc + item.quantity, 0);

    expect(total).toBe(100);
    expect(itemCount).toBe(1);
  });

  it('should update item quantity', () => {
    const { result } = renderHook(() => useCartStore());
    const testProduct = {
      productId: '1',
      slug: 'test-product',
      title: 'Test Product',
      currency: 'EUR',
      basePrice: 100,
      unitPrice: 100,
      selectedOptions: [],
      addOns: [],
      customFields: []
    };

    act(() => {
      result.current.addItem(testProduct);
      result.current.updateQuantity('1', 3);
    });

    expect(result.current.items[0].quantity).toBe(3);

    // Calculate totals manually
    const total = result.current.items.reduce((acc, item) => acc + item.unitPrice * item.quantity, 0);
    const itemCount = result.current.items.reduce((acc, item) => acc + item.quantity, 0);

    expect(total).toBe(300);
    expect(itemCount).toBe(3);
  });

  it('should remove item from cart', () => {
    const { result } = renderHook(() => useCartStore());
    const testProduct = {
      productId: '1',
      slug: 'test-product',
      title: 'Test Product',
      currency: 'EUR',
      basePrice: 100,
      unitPrice: 100,
      selectedOptions: [],
      addOns: [],
      customFields: []
    };

    act(() => {
      result.current.addItem(testProduct);
    });

    expect(result.current.items).toHaveLength(1);

    act(() => {
      result.current.removeItem('1');
    });

    expect(result.current.items).toHaveLength(0);

    // Calculate totals manually
    const total = result.current.items.reduce((acc, item) => acc + item.unitPrice * item.quantity, 0);
    expect(total).toBe(0);
  });

  it('should calculate totals correctly with multiple items', () => {
    const { result } = renderHook(() => useCartStore());

    act(() => {
      result.current.addItem({
        productId: '1',
        slug: 'product-1',
        title: 'Product 1',
        currency: 'EUR',
        basePrice: 50,
        unitPrice: 50,
        selectedOptions: [],
        addOns: [],
        customFields: []
      });

      result.current.addItem({
        productId: '2',
        slug: 'product-2',
        title: 'Product 2',
        currency: 'EUR',
        basePrice: 75,
        unitPrice: 75,
        selectedOptions: [],
        addOns: [],
        customFields: []
      });
    });

    // Calculate totals manually
    const total = result.current.items.reduce((acc, item) => acc + item.unitPrice * item.quantity, 0);
    const itemCount = result.current.items.reduce((acc, item) => acc + item.quantity, 0);

    expect(total).toBe(125); // 50 + 75
    expect(itemCount).toBe(2); // 1 + 1
    expect(result.current.items).toHaveLength(2);
  });

  it('should persist cart to localStorage', () => {
    const { result } = renderHook(() => useCartStore());
    const testProduct = {
      productId: '1',
      slug: 'test-product',
      title: 'Test Product',
      currency: 'EUR',
      basePrice: 100,
      unitPrice: 100,
      selectedOptions: [],
      addOns: [],
      customFields: []
    };

    act(() => {
      result.current.addItem(testProduct);
    });

    // Check if localStorage was updated (mocked in test environment)
    expect(localStorage.getItem('cart')).toBeTruthy();
  });
});
