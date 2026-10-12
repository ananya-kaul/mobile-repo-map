import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:flutter_shop/core/network/api_client.dart';
import 'package:flutter_shop/core/network/api_config.dart';
import 'package:flutter_shop/features/cart/data/cart_repository.dart';

enum PaymentMethod { card, applePay, googlePay, cashOnDelivery }

enum DeliverySpeed { standard, express, sameDay }

class CheckoutQuote {
  const CheckoutQuote({
    required this.subtotal,
    required this.shipping,
    required this.tax,
    this.discount = 0,
    this.currency = 'USD',
  });

  final double subtotal;
  final double shipping;
  final double tax;
  final double discount;
  final String currency;

  double get total => subtotal + shipping + tax - discount;

  factory CheckoutQuote.fromJson(Map<String, dynamic> json) => CheckoutQuote(
        subtotal: (json['subtotal'] as num).toDouble(),
        shipping: (json['shipping'] as num).toDouble(),
        tax: (json['tax'] as num).toDouble(),
        discount: (json['discount'] as num?)?.toDouble() ?? 0,
        currency: json['currency'] as String? ?? 'USD',
      );
}

class CheckoutService {
  CheckoutService(this._dio, this._cart);

  final Dio _dio;
  final CartRepository _cart;

  Future<CheckoutQuote> quote({String? promoCode, DeliverySpeed speed = DeliverySpeed.standard}) async {
    final response = await _dio.post(
      '/checkout/quote',
      data: {'promo_code': promoCode, 'speed': speed.name},
    );
    return CheckoutQuote.fromJson(response.data as Map<String, dynamic>);
  }

  Future<String> placeOrder({
    required PaymentMethod payment,
    required DeliverySpeed speed,
    String? promoCode,
    bool giftWrap = false,
  }) async {
    final items = await _cart.fetchCart();
    if (items.isEmpty) {
      throw StateError('Cart is empty');
    }
    final response = await _dio.post(
      ApiConfig.checkout,
      data: {
        'items': [for (final i in items) i.toJson()],
        'payment_method': payment.name,
        'speed': speed.name,
        'promo_code': promoCode,
        'gift_wrap': giftWrap,
      },
    );
    return response.data['order_id'] as String;
  }
}

final checkoutServiceProvider = Provider<CheckoutService>(
  (ref) => CheckoutService(ref.watch(dioProvider), ref.watch(cartRepositoryProvider)),
);
