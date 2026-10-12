import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:flutter_shop/features/catalog/data/product.dart';
import '../data/cart_item.dart';
import '../data/cart_repository.dart';

class CartState {
  const CartState({this.items = const [], this.syncing = false});

  final List<CartItem> items;
  final bool syncing;

  int get totalQuantity => items.fold(0, (sum, i) => sum + i.quantity);
  double get subtotal => items.fold(0, (sum, i) => sum + i.lineTotal);
  bool get isEmpty => items.isEmpty;

  CartState copyWith({List<CartItem>? items, bool? syncing}) =>
      CartState(items: items ?? this.items, syncing: syncing ?? this.syncing);
}

class CartController extends Notifier<CartState> {
  @override
  CartState build() => const CartState();

  CartRepository get _repository => ref.read(cartRepositoryProvider);

  Future<void> add(Product product) async {
    final existing = state.items.where((i) => i.productId == product.id).firstOrNull;
    if (existing != null) {
      await setQuantity(existing, existing.quantity + 1);
      return;
    }
    final optimistic = CartItem.fromProduct(product);
    state = state.copyWith(items: [...state.items, optimistic], syncing: true);
    try {
      final saved = await _repository.addItem(optimistic);
      state = state.copyWith(
        items: [for (final i in state.items) i.id == optimistic.id ? saved : i],
        syncing: false,
      );
    } catch (_) {
      state = state.copyWith(
        items: state.items.where((i) => i.id != optimistic.id).toList(),
        syncing: false,
      );
      rethrow;
    }
  }

  Future<void> setQuantity(CartItem item, int quantity) async {
    if (quantity <= 0) return remove(item);
    state = state.copyWith(
      items: [for (final i in state.items) i.id == item.id ? i.copyWith(quantity: quantity) : i],
    );
    await _repository.updateQuantity(item.id, quantity);
  }

  Future<void> remove(CartItem item) async {
    state = state.copyWith(items: state.items.where((i) => i.id != item.id).toList());
    await _repository.removeItem(item.id);
  }

  void clear() => state = const CartState();
}

final cartControllerProvider =
    NotifierProvider<CartController, CartState>(CartController.new);
