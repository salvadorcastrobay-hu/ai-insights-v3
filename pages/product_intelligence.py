import streamlit as st
import plotly.express as px
import plotly.graph_objects as go
from shared import humanize

df = st.session_state.get("filtered_df")
if df is None or df.empty:
    st.warning("No hay datos para mostrar.")
    st.stop()

st.header("Product Intelligence")

# === Section A: Pains ===
st.subheader("A. Pains")
pains = df[df["insight_type"] == "pain"].copy()
if pains.empty:
    st.info("No hay pains en los datos filtrados.")
else:
    pains["pain_theme"] = pains["pain_theme"].map(humanize)
    # Top 15 pains
    top_pains = pains["insight_subtype_display"].value_counts().head(15).reset_index()
    top_pains.columns = ["Pain", "Frecuencia"]
    fig = px.bar(top_pains, x="Frecuencia", y="Pain", orientation="h", title="Top 15 Pains")
    fig.update_layout(yaxis=dict(autorange="reversed"))
    st.plotly_chart(fig, use_container_width=True)

    col_left, col_right = st.columns(2)
    with col_left:
        theme_counts = pains["pain_theme"].value_counts().reset_index()
        theme_counts.columns = ["Theme", "Cantidad"]
        fig = px.bar(theme_counts, x="Theme", y="Cantidad", title="Pains por Theme", color="Theme")
        fig.update_layout(showlegend=False)
        st.plotly_chart(fig, use_container_width=True)

    with col_right:
        # Heatmap: pain_subtype x segment
        if "segment" in pains.columns:
            pains_seg = pains.dropna(subset=["segment"])
            if not pains_seg.empty:
                top_pain_names = pains_seg["insight_subtype_display"].value_counts().head(15).index
                hm_data = (
                    pains_seg[pains_seg["insight_subtype_display"].isin(top_pain_names)]
                    .groupby(["insight_subtype_display", "segment"]).size()
                    .reset_index(name="count")
                )
                pivot = hm_data.pivot(index="insight_subtype_display", columns="segment", values="count").fillna(0)
                fig = px.imshow(
                    pivot, text_auto=True, aspect="auto",
                    title="Top 15 Pains x Segmento",
                    labels=dict(x="Segmento", y="Pain", color="Cantidad"),
                )
                st.plotly_chart(fig, use_container_width=True)

    # Top pains por modulo con revenue impact
    module_pains = pains.dropna(subset=["module_display"])
    if not module_pains.empty:
        mod_revenue = (
            module_pains.drop_duplicates(subset=["deal_id", "module_display"])
            .groupby("module_display")
            .agg(frecuencia=("module_display", "size"), revenue=("amount", "sum"))
            .reset_index()
            .sort_values("revenue", ascending=False)
            .head(15)
        )
        fig = go.Figure()
        fig.add_trace(go.Bar(
            y=mod_revenue["module_display"], x=mod_revenue["frecuencia"],
            name="Frecuencia", orientation="h", marker_color="#636EFA",
        ))
        fig.add_trace(go.Bar(
            y=mod_revenue["module_display"], x=mod_revenue["revenue"],
            name="Revenue ($)", orientation="h", marker_color="#EF553B",
            xaxis="x2",
        ))
        fig.update_layout(
            title="Pains por Modulo — Revenue Impact",
            xaxis=dict(title="Frecuencia"), xaxis2=dict(title="Revenue ($)", side="top", overlaying="x"),
            yaxis=dict(autorange="reversed"), barmode="group",
            legend=dict(orientation="h", y=-0.15),
        )
        st.plotly_chart(fig, use_container_width=True)

# === Section B: Feature Gaps ===
st.subheader("B. Feature Gaps")
gaps = df[df["insight_type"] == "product_gap"].copy()
if gaps.empty:
    st.info("No hay product gaps en los datos filtrados.")
else:
    if "gap_priority" in gaps.columns:
        gaps["gap_priority"] = gaps["gap_priority"].map(humanize)
    if "module_status" in gaps.columns:
        gaps["module_status"] = gaps["module_status"].map(humanize)
    # Top 20 features
    feature_counts = gaps["feature_display"].value_counts().head(20).reset_index()
    feature_counts.columns = ["Feature", "Frecuencia"]
    fig = px.bar(feature_counts, x="Frecuencia", y="Feature", orientation="h", title="Top 20 Features Faltantes")
    fig.update_layout(yaxis=dict(autorange="reversed"))
    st.plotly_chart(fig, use_container_width=True)

    col_left, col_right = st.columns(2)
    with col_left:
        if "gap_priority" in gaps.columns:
            priority_counts = gaps["gap_priority"].value_counts().reset_index()
            priority_counts.columns = ["Prioridad", "Cantidad"]
            fig = px.pie(priority_counts, values="Cantidad", names="Prioridad", title="Distribucion por Prioridad")
            st.plotly_chart(fig, use_container_width=True)

    with col_right:
        # Feature gaps por segment — stacked bar
        if "segment" in gaps.columns:
            gaps_seg = gaps.dropna(subset=["segment"])
            if not gaps_seg.empty:
                top_features = gaps_seg["feature_display"].value_counts().head(15).index
                seg_data = (
                    gaps_seg[gaps_seg["feature_display"].isin(top_features)]
                    .groupby(["feature_display", "segment"]).size()
                    .reset_index(name="count")
                )
                fig = px.bar(
                    seg_data, x="count", y="feature_display", color="segment",
                    orientation="h", title="Feature Gaps por Segmento (Top 15)",
                )
                fig.update_layout(yaxis=dict(autorange="reversed"))
                st.plotly_chart(fig, use_container_width=True)

    # Revenue at stake
    gap_rev = (
        gaps.drop_duplicates(subset=["deal_id", "feature_display"])
        .groupby("feature_display")["amount"].sum()
        .reset_index()
        .sort_values("amount", ascending=False)
        .head(10)
    )
    gap_rev.columns = ["Feature", "Revenue at Stake"]
    if gap_rev["Revenue at Stake"].sum() > 0:
        fig = px.bar(
            gap_rev, x="Revenue at Stake", y="Feature", orientation="h",
            title="Revenue at Stake — Top 10 Features",
        )
        fig.update_layout(yaxis=dict(autorange="reversed"))
        st.plotly_chart(fig, use_container_width=True)

    # Modulos missing vs existing
    if "module_status" in gaps.columns:
        status_counts = gaps.groupby("module_status").size().reset_index(name="count")
        if not status_counts.empty:
            fig = px.bar(
                status_counts, x="module_status", y="count", color="module_status",
                title="Gaps: Modulos Existing vs Missing",
                labels={"module_status": "Status del Modulo", "count": "Cantidad"},
            )
            fig.update_layout(showlegend=False)
            st.plotly_chart(fig, use_container_width=True)
