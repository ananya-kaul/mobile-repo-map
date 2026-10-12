import 'package:flutter_test/flutter_test.dart';

import 'package:flutter_shop/core/utils/formatters.dart';

void main() {
  group('Formatters.price', () {
    test('groups thousands and keeps two decimals', () {
      expect(Formatters.price(1234567.5), r'$1,234,567.50');
    });

    test('uses the currency symbol', () {
      expect(Formatters.price(9.99, currency: 'EUR'), '€9.99');
    });

    test('falls back to the currency code', () {
      expect(Formatters.price(5, currency: 'CHF'), 'CHF 5.00');
    });
  });

  test('shortDate', () {
    expect(Formatters.shortDate(DateTime(2024, 3, 7)), '07 Mar 2024');
  });

  test('quantity pluralises', () {
    expect(Formatters.quantity(1), '1 item');
    expect(Formatters.quantity(3), '3 items');
  });

  test('maskEmail hides the local part', () {
    expect(Formatters.maskEmail('jane@example.com'), 'j***@example.com');
  });
}
