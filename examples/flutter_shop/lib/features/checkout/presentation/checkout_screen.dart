import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:flutter_shop/core/utils/formatters.dart';
import 'package:flutter_shop/features/auth/application/auth_controller.dart';
import 'package:flutter_shop/features/cart/application/cart_controller.dart';
import 'package:flutter_shop/router/app_routes.dart';
import '../application/checkout_service.dart';

class CheckoutScreen extends ConsumerStatefulWidget {
  const CheckoutScreen({super.key});

  @override
  ConsumerState<CheckoutScreen> createState() => _CheckoutScreenState();
}

class _CheckoutScreenState extends ConsumerState<CheckoutScreen> {
  final _promo = TextEditingController();
  PaymentMethod _payment = PaymentMethod.card;
  DeliverySpeed _speed = DeliverySpeed.standard;
  String? _appliedPromo;
  String? _promoError;
  String? _error;
  bool _giftWrap = false;
  bool _acceptTerms = false;
  bool _submitting = false;

  @override
  void dispose() {
    _promo.dispose();
    super.dispose();
  }

  void _applyPromo() {
    final code = _promo.text.trim().toUpperCase();
    setState(() {
      if (code.isEmpty) {
        _promoError = 'Enter a code';
      } else if (code.length < 4 || code.length > 12) {
        _promoError = 'Codes are 4–12 characters';
      } else if (code == 'FREESHIP' || code == 'SAVE10' || code == 'WELCOME') {
        _appliedPromo = code;
        _promoError = null;
      } else {
        _promoError = 'This code is not valid';
      }
    });
  }

  Future<void> _placeOrder() async {
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      await ref.read(checkoutServiceProvider).placeOrder(
            payment: _payment,
            speed: _speed,
            promoCode: _appliedPromo,
            giftWrap: _giftWrap,
          );
      ref.read(cartControllerProvider.notifier).clear();
      if (!mounted) return;
      context.go(AppRoute.orders.path);
    } catch (e) {
      setState(() => _error = 'Payment failed: $e');
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final cart = ref.watch(cartControllerProvider);
    final loggedIn = ref.watch(isLoggedInProvider);
    final theme = Theme.of(context);
    final subtotal = cart.subtotal;
    final hour = DateTime.now().hour;

    // Shipping: depends on speed, basket size, promo and time of day.
    double shipping;
    String shippingNote;
    bool speedAvailable = true;
    switch (_speed) {
      case DeliverySpeed.standard:
        if (subtotal >= 50 || _appliedPromo == 'FREESHIP') {
          shipping = 0;
          shippingNote = 'Free standard shipping';
        } else {
          shipping = 4.99;
          shippingNote = 'Free over ${Formatters.price(50)}';
        }
      case DeliverySpeed.express:
        if (_appliedPromo == 'FREESHIP' && subtotal >= 100) {
          shipping = 0;
          shippingNote = 'Express shipping on us';
        } else if (subtotal >= 100) {
          shipping = 7.99;
          shippingNote = 'Reduced express rate';
        } else {
          shipping = 12.99;
          shippingNote = 'Arrives in 1–2 days';
        }
      case DeliverySpeed.sameDay:
        if (hour >= 14) {
          speedAvailable = false;
          shipping = 0;
          shippingNote = 'Same-day cut-off is 2 pm';
        } else if (cart.totalQuantity > 5 || subtotal > 500) {
          speedAvailable = false;
          shipping = 0;
          shippingNote = 'Too large for same-day courier';
        } else {
          shipping = 19.99;
          shippingNote = 'Arrives today';
        }
    }

    // Discounts
    double discount = 0;
    if (_appliedPromo != null) {
      switch (_appliedPromo) {
        case 'SAVE10':
          discount = subtotal * 0.10;
        case 'WELCOME':
          discount = loggedIn ? 5 : 0;
        case 'FREESHIP':
          discount = 0;
        default:
          discount = 0;
      }
    }
    final giftWrapFee = _giftWrap ? (subtotal > 200 ? 0.0 : 3.5) : 0.0;
    final tax = (subtotal - discount) * 0.08;
    final total = subtotal + shipping + tax + giftWrapFee - discount;

    // Payment availability
    final codAllowed = total < 300 && _speed != DeliverySpeed.sameDay;
    final walletAllowed = Theme.of(context).platform == TargetPlatform.iOS
        ? _payment != PaymentMethod.googlePay
        : _payment != PaymentMethod.applePay;
    final canSubmit = !_submitting &&
        !cart.isEmpty &&
        speedAvailable &&
        _acceptTerms &&
        (loggedIn || _payment != PaymentMethod.cashOnDelivery) &&
        (_payment != PaymentMethod.cashOnDelivery || codAllowed) &&
        walletAllowed;

    String? blocker;
    if (cart.isEmpty) {
      blocker = 'Your cart is empty';
    } else if (!speedAvailable) {
      blocker = shippingNote;
    } else if (!_acceptTerms) {
      blocker = 'Please accept the terms of sale';
    } else if (_payment == PaymentMethod.cashOnDelivery && !codAllowed) {
      blocker = total >= 300 ? 'Cash on delivery is limited to orders under ${Formatters.price(300)}' : 'Cash on delivery is not available for same-day';
    } else if (!walletAllowed) {
      blocker = 'That wallet is not supported on this device';
    }

    return Scaffold(
      appBar: AppBar(title: const Text('Checkout')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (!loggedIn)
            Card(
              color: theme.colorScheme.secondaryContainer,
              child: ListTile(
                leading: const Icon(Icons.lock_outline),
                title: const Text('Sign in to save this order to your account'),
                trailing: TextButton(
                  onPressed: () => context.push(AppRoute.login.path),
                  child: const Text('Sign in'),
                ),
              ),
            ),
          Text('Delivery', style: theme.textTheme.titleMedium),
          for (final speed in DeliverySpeed.values)
            RadioListTile<DeliverySpeed>(
              value: speed,
              groupValue: _speed,
              onChanged: _submitting ? null : (v) => setState(() => _speed = v ?? _speed),
              title: Text(switch (speed) {
                DeliverySpeed.standard => 'Standard (3–5 days)',
                DeliverySpeed.express => 'Express (1–2 days)',
                DeliverySpeed.sameDay => 'Same day',
              }),
              subtitle: speed == _speed ? Text(shippingNote) : null,
            ),
          const Divider(),
          Text('Payment', style: theme.textTheme.titleMedium),
          for (final method in PaymentMethod.values)
            if (method != PaymentMethod.cashOnDelivery || codAllowed || _payment == method)
              RadioListTile<PaymentMethod>(
                value: method,
                groupValue: _payment,
                onChanged: _submitting ? null : (v) => setState(() => _payment = v ?? _payment),
                title: Text(switch (method) {
                  PaymentMethod.card => 'Credit or debit card',
                  PaymentMethod.applePay => 'Apple Pay',
                  PaymentMethod.googlePay => 'Google Pay',
                  PaymentMethod.cashOnDelivery => 'Cash on delivery',
                }),
              ),
          const Divider(),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _promo,
                  enabled: _appliedPromo == null && !_submitting,
                  decoration: InputDecoration(
                    labelText: _appliedPromo == null ? 'Promo code' : 'Applied: $_appliedPromo',
                    errorText: _promoError,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              if (_appliedPromo == null)
                OutlinedButton(onPressed: _applyPromo, child: const Text('Apply'))
              else
                TextButton(
                  onPressed: () => setState(() {
                    _appliedPromo = null;
                    _promo.clear();
                  }),
                  child: const Text('Remove'),
                ),
            ],
          ),
          CheckboxListTile(
            value: _giftWrap,
            onChanged: (v) => setState(() => _giftWrap = v ?? false),
            title: Text(subtotal > 200 ? 'Gift wrap (free)' : 'Gift wrap (+${Formatters.price(3.5)})'),
          ),
          CheckboxListTile(
            value: _acceptTerms,
            onChanged: (v) => setState(() => _acceptTerms = v ?? false),
            title: const Text('I accept the terms of sale'),
          ),
          const Divider(),
          _SummaryRow('Subtotal', Formatters.price(subtotal)),
          _SummaryRow('Shipping', shipping == 0 && speedAvailable ? 'Free' : Formatters.price(shipping)),
          if (giftWrapFee > 0) _SummaryRow('Gift wrap', Formatters.price(giftWrapFee)),
          if (discount > 0) _SummaryRow('Discount', '-${Formatters.price(discount)}'),
          _SummaryRow('Tax', Formatters.price(tax)),
          _SummaryRow('Total', Formatters.price(total), emphasize: true),
          if (_error != null || blocker != null)
            Padding(
              padding: const EdgeInsets.only(top: 12),
              child: Text(
                _error ?? blocker!,
                style: TextStyle(color: _error != null ? theme.colorScheme.error : theme.hintColor),
              ),
            ),
        ],
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: FilledButton(
            onPressed: canSubmit ? _placeOrder : null,
            child: _submitting
                ? const SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2))
                : Text('Pay ${Formatters.price(total)}'),
          ),
        ),
      ),
    );
  }
}

class _SummaryRow extends StatelessWidget {
  const _SummaryRow(this.label, this.value, {this.emphasize = false});

  final String label;
  final String value;
  final bool emphasize;

  @override
  Widget build(BuildContext context) {
    final style = emphasize ? Theme.of(context).textTheme.titleMedium : null;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Text(label, style: style),
          const Spacer(),
          Text(value, style: style),
        ],
      ),
    );
  }
}
