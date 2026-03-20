import streamlit as st
from sql_chat_agent import page_sql_chat
from exp_ds import inject_ds_css, DS, apply_ds_layout, BRAND_SCALE, ds_sub

inject_ds_css()

page_sql_chat(st.session_state.get("df"))
