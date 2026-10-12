import 'package:flutter/foundation.dart';

/// Shared formatting helpers. Nearly every screen pulls something from here.
class Formatters {
  const Formatters._();

  static String price(num amount, {String currency = 'USD'}) {
    final symbol = _symbols[currency] ?? '$currency ';
    final fixed = amount.toStringAsFixed(2);
    final parts = fixed.split('.');
    final whole = _groupThousands(parts[0]);
    return '$symbol$whole.${parts[1]}';
  }

  static String shortDate(DateTime date) {
    final d = date.day.toString().padLeft(2, '0');
    final m = _months[date.month - 1];
    return '$d $m ${date.year}';
  }

  static String quantity(int count) => count == 1 ? '1 item' : '$count items';

  static String rating(double value) => '${value.toStringAsFixed(1)} / 5';

  static String orderNumber(String id) =>
      '#${id.length > 8 ? id.substring(0, 8) : id}'.toUpperCase();

  static String maskEmail(String email) {
    final at = email.indexOf('@');
    if (at <= 1) return email;
    return '${email[0]}***${email.substring(at)}';
  }

  static String _groupThousands(String digits) {
    final negative = digits.startsWith('-');
    final raw = negative ? digits.substring(1) : digits;
    final buffer = StringBuffer();
    for (var i = 0; i < raw.length; i++) {
      if (i > 0 && (raw.length - i) % 3 == 0) buffer.write(',');
      buffer.write(raw[i]);
    }
    return negative ? '-$buffer' : buffer.toString();
  }

  static const Map<String, String> _symbols = {
    'USD': r'$',
    'EUR': '€',
    'GBP': '£',
    'INR': '₹',
  };

  static const List<String> _months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];

  @visibleForTesting
  static String groupThousandsForTest(String digits) => _groupThousands(digits);
}
