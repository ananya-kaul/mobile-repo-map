class ApiConfig {
  const ApiConfig._();

  static const String baseUrl = 'https://api.flutter-shop.dev/v1';

  static const String products = '/products';
  static const String cartItems = '/cart/items';
  static const String checkout = '/checkout';
  static const String orders = '/orders';
  static const String login = '/auth/login';
  static const String logout = '/auth/logout';

  static const Duration connectTimeout = Duration(seconds: 10);
  static const Duration receiveTimeout = Duration(seconds: 20);
}
