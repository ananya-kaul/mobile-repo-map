import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:flutter_shop/core/network/api_client.dart';
import 'package:flutter_shop/core/network/api_config.dart';
import 'package:flutter_shop/features/checkout/application/checkout_service.dart';
import 'cart_item.dart';

class CartRepository {
  CartRepository(this._dio);

  final Dio _dio;
  CheckoutQuote? _lastQuote;

  CheckoutQuote? get lastQuote => _lastQuote;

  Future<List<CartItem>> fetchCart() async {
    final response = await _dio.get(ApiConfig.cartItems);
    final items = response.data as List<dynamic>;
    return items.map((e) => CartItem.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<CartItem> addItem(CartItem item) async {
    final response = await _dio.post('/cart/items', data: item.toJson());
    return CartItem.fromJson(response.data as Map<String, dynamic>);
  }

  Future<void> updateQuantity(String itemId, int quantity) async {
    await _dio.patch('/cart/items/$itemId', data: {'quantity': quantity});
  }

  Future<void> removeItem(String itemId) async {
    await _dio.delete('/cart/items/$itemId');
  }

  // TODO(cart): the quote preview belongs in checkout; it is only here so the
  // cart badge can show a shipping estimate without another provider.
  Future<CheckoutQuote> refreshQuote(CheckoutService checkout) async {
    _lastQuote = await checkout.quote(speed: DeliverySpeed.standard);
    return _lastQuote!;
  }
}

final cartRepositoryProvider = Provider<CartRepository>(
  (ref) => CartRepository(ref.watch(dioProvider)),
);
